# Justice Invisible Advisor 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `justice` プラグインに「Plan-to-Execution Bridge」「Role-based Wisdom Store」「SDD Native Error Handling」「Toast 相当通知」の 4 機能を導入し、SDD を裏側から強制誘導する不可視参謀を完成させる。

**Architecture:** hook-first / stateless / atomic-FS の原則を維持。`WisdomStore` を `Map<AgentId, WisdomEntry[]>` 内部表現に再構成、`wisdom.json` を v1→v2 マイグレーション、`PostToolUse` 経路に `PlanCompletionDetector` と `ReviewRejectionDetector` を追加。新規 npm 依存ゼロ。

**Tech Stack:** TypeScript (strict + readonly), Bun, Vitest, Node.js `fs/promises`, `@opencode-ai/plugin`

**Design Spec:** `docs/superpowers/specs/2026-05-21-justice-invisible-advisor-design.md`

**Git Workflow Reference:** [AI-Native Stacked PR Workflow](https://different-sunday-448.notion.site/AI-Native-Stacked-PR-Workflow-3611669a4c16802eb032eb4ab05a8adb)

---

## Infrastructure

CI/CD (`.github/workflows/ci.yml`: `master` トリガー、`runs-on: ubuntu-slim`、`bun run lint/typecheck/test/build` 実行済み) および Devcontainer (`.devcontainer/devcontainer.json` + `Dockerfile`) は既存。**Phase 0 は不要**。

## 全 Task 共通: 検証手順

**Devcontainer 内**で以下を実行し、すべてグリーンであること。ローカルホストでの実行は禁止。

```bash
bun install --frozen-lockfile
bun run typecheck   # tsc --noEmit
bun run lint        # ESLint (eslint.config.mjs)
bun run test        # Vitest
bun run build       # dist/opencode-plugin.js を生成
```

検収基準:
- `typecheck` / `lint` ともに warning 0
- 既存 Vitest テスト + 新規/更新分すべて pass
- `dist/opencode-plugin.js` が正常生成

## Git Branch Strategy (Stacked PR Workflow)

**Phase Base ブランチ:** `feature/justice-invisible-advisor__base` (現在のブランチ。`master` から派生済み)

**派生元の判断ルール:**
- **Base から派生**: 単体で型/テストが完結し、他 Task に依存しない独立タスク。
- **直前 Task から派生**: 直前 Task の型・API・ファイル変更に依存し、それなしではコンパイル・テストが通らないタスク。

**依存カテゴリの用語定義** (並列開発判断のため):
- **完全独立**: 他 Task の型・実装・テストに一切依存せず、`master` 直派生で単体ビルド・テストが通る。並列開発で何の調整も不要。
- **型依存** (type-dependent): 別 Task で追加される型/インターフェースを参照するが、実装ロジックには非依存。並列開発する場合は (a) 先行 Task ブランチをローカル取り込み、(b) 型を一時的に再宣言、いずれかで隔離可能。最終マージ順だけ規定される。
- **実装依存** (runtime-dependent): 別 Task で追加される実装/関数の呼び出しに依存。先行 Task のマージなしには動作テストが通らない。
- **マージ前提** (merge-prerequisite): 別 Phase の全 Task が `master` 経由でマージ済みであることを前提とする。Phase をまたぐ大括りの依存。

```text
master
└── feature/justice-invisible-advisor__base   ← Phase Base (全 PR のターゲット)
    ├── Phase 1: Foundation & Notification Layer
    │   ├── feature/jia-phase1-task1_justice-notifier            ← Base 派生 (完全独立)
    │   ├── feature/jia-phase1-task2_opencode-notifier           ← Base 派生 (型依存: Task1 の JusticeNotifier)
    │   ├── feature/jia-phase1-task3_persona-classifier          ← Base 派生 (完全独立)
    │   └── feature/jia-phase1-task4_review-rejection-detector   ← Base 派生 (完全独立)
    │
    ├── Phase 2: Role-based Wisdom Store
    │   ├── feature/jia-phase2-task1_wisdom-types-extension      ← Base 派生
    │   ├── feature/jia-phase2-task2_wisdom-store-by-persona     ← Task1 派生
    │   ├── feature/jia-phase2-task3_wisdom-persistence-v2       ← Task2 派生
    │   ├── feature/jia-phase2-task4_tiered-wisdom-persona       ← Task3 派生
    │   └── feature/jia-phase2-task5_learning-extractor-persona  ← Task4 派生
    │
    ├── Phase 3: Plan-to-Execution Bridge
    │   ├── feature/jia-phase3-task1_plan-completion-detector    ← Base 派生 (型依存: Phase 1 Task 3 の AgentId 推定ロジック参照)
    │   ├── feature/jia-phase3-task2_merge-posttooluse           ← Base 派生 (型依存: HookResponse 既存型のみ)
    │   └── feature/jia-phase3-task3_plan-bridge-handle-post     ← Task2 派生 (マージ前提: Phase 2 全 + Phase 3-1/2)
    │
    ├── Phase 4: SDD Native Error Handling
    │   ├── feature/jia-phase4-task1_loop-handler-pivot          ← Base 派生 (マージ前提: Phase 1 Task 4 + Phase 2 全)
    │   ├── feature/jia-phase4-task2_plan-bridge-pivot-route     ← Task1 派生 (マージ前提: Phase 3 全)
    │   └── feature/jia-phase4-task3_sisyphus-wisdom-route       ← Task2 派生 (実装依存)
    │
    └── Phase 5: Integration & Wrap-up
        ├── feature/jia-phase5-task1_adapter-wiring               ← Base 派生 (マージ前提: Phase 1-4 全)
        ├── feature/jia-phase5-task2_integration-tests            ← Task1 派生 (実装依存)
        └── feature/jia-phase5-task3_final-verification           ← Task2 派生 (実装依存)
```

**PR 戦略:** 各 Task は実装完了後、必ず `feature/justice-invisible-advisor__base` をターゲットに **Draft PR** を作成。レビュー完了後にマージし、後続 Task の base を rebase で追従させる。

---

## Phase 1: Foundation & Notification Layer

純粋ロジックおよび通知抽象の追加。後続 Phase が参照する独立コンポーネント群。各 Task は Base から並列開発可能。

### Task 1: `JusticeNotifier` インターフェースと `NoOpNotifier`

**Branch:** `feature/jia-phase1-task1_justice-notifier` ← Base 派生 (完全独立)

**Files:**
- Add: `src/core/justice-notifier.ts`
- Add: `tests/core/justice-notifier.test.ts`
- Add: `tests/helpers/mock-notifier.ts`
- Modify: `src/index.ts` (エクスポート追加)

**Steps:**

- [x] **Step 1: Vitest テストを TDD で先行作成** — 設計書 §9-5 の表 #1〜#6 を網羅。`NoOpNotifier.notify()` が `undefined` を返すこと、`formatBanner` が空文字列を返すこと、アイコンマッピング (§7-3) に従い `🎯`/`🚧`/`🔬`/`🚨`/`💡`/`🔁` が正しく挿入されることを assert。
- [x] **Step 2: `JusticeNotifier` インターフェース、`JusticeNotification` 型、`NotificationLevel`/`NotificationVariant` 型を実装** — 設計書 §7-2 のシグネチャに完全準拠。`readonly` 必須。`notify()` の JSDoc に fail-open 契約（内部で全例外を吸収し再 throw しない）を明記すること。
- [x] **Step 3: `NoOpNotifier` 実装** — `notify()` は `void`、`formatBanner()` は `""` を返す。
- [x] **Step 4: アイコンマッピングを純粋関数 `iconFor(variant)` として実装し、`formatBanner` の参照型実装を提供** — 後続 Task で `OpenCodeNotifier` がこれを再利用する基盤として、`src/core/justice-notifier.ts` 内に export しておく (※他 Notifier 実装からも参照可能)。
- [x] **Step 5: `tests/helpers/mock-notifier.ts` の `createMockNotifier()` を実装** — `calls` 配列に `notify` 引数を push、`banners` 配列に `formatBanner` 戻り値を push。
- [x] **Step 6: `src/index.ts` から新規型/クラスを export**
- [x] **Step 7: Devcontainer 内で `bun run typecheck && bun run lint && bun run test` を実行し全 pass を確認**
- [x] **Step 8: Phase Base (`feature/justice-invisible-advisor__base`) に向けた Draft PR を作成**

### Task 2: `OpenCodeNotifier` (runtime 層)

**Branch:** `feature/jia-phase1-task2_opencode-notifier` ← Base 派生 (型依存: Task 1 の `JusticeNotifier`)

> **注意:** Task 1 の `JusticeNotifier` 型が未マージの段階で並行開発する場合は、ローカルで Task 1 ブランチを取り込む or 一時的に型を再宣言して隔離。最終マージ順は Task 1 → Task 2 を推奨。

**Files:**
- Add: `src/runtime/opencode-notifier.ts`
- Add: `tests/runtime/opencode-notifier.test.ts`
- Modify: `src/index.ts`

**Steps:**

- [x] **Step 1: Vitest テストを先行作成** — 設計書 §9-6 の表 #1〜#7 を網羅。`level` マッピング (`success → info`, `warning → warn`)、`service: "justice"` 固定、`extra` フィールドに `variant`/`sessionId`/`taskId` が含まれること、`log` 関数 throw 時に `notify()` が再 throw しないこと。
- [x] **Step 2: `OpenCodeNotifier` クラスを実装** — `constructor(log: (entry) => Promise<void> | void)`、`notify()` で `try/catch` ですべての例外を吸収、`formatBanner()` は §7-4 の 3 行構成 (`> <icon> **JUSTICE NOTIFICATION** [<title>]` / `> <message>` / `""`) を返す。
- [x] **Step 3: `OpenCodeLogEntry` 型は既存 `src/runtime/` の型を参照** — 既存定義がない場合は最小フィールド (`level`/`service`/`message`/`extra`) で local 定義し export。
- [x] **Step 4: `src/index.ts` から `OpenCodeNotifier` を export** (runtime 層の慣例に従う)
- [x] **Step 5: Devcontainer 内で `bun run typecheck && bun run lint && bun run test` を実行**
- [x] **Step 6: Phase Base に向けた Draft PR を作成**

### Task 3: `PersonaClassifier`

**Branch:** `feature/jia-phase1-task3_persona-classifier` ← Base 派生 (完全独立)

**Files:**
- Add: `src/core/persona-classifier.ts`
- Add: `tests/core/persona-classifier.test.ts`
- Modify: `src/index.ts`

**Steps:**

- [x] **Step 1: Vitest テストを先行作成** — 設計書 §9-1 の表 #1〜#12 を完全網羅。優先順位 (errorClass=`design_error` → atlas、`loop_detected`/`timeout` → sisyphus、category=`design_decision` → atlas、`environment_quirk` → sisyphus、`success_pattern`/`failure_gotcha` → hephaestus、デフォルト → hephaestus) を境界含めて検証。
- [x] **Step 2: `PersonaClassifier.classify({ category, errorClass })` を実装** — 設計書 §3-4 の優先順位通り。`DEFAULT_PERSONA = "hephaestus"` を export。
- [x] **Step 3: 純粋関数 export (クラスではなくモジュール関数でも可、設計書 §3-4 のシグネチャに準拠)**
- [x] **Step 4: `src/index.ts` から export**
- [x] **Step 5: Devcontainer 内で全検証コマンド実行**
- [x] **Step 6: Phase Base に向けた Draft PR を作成**

### Task 4: `review-rejection-patterns` + `ReviewRejectionDetector`

**Branch:** `feature/jia-phase1-task4_review-rejection-detector` ← Base 派生 (完全独立)

**Files:**
- Add: `src/core/review-rejection-patterns.ts`
- Add: `src/core/review-rejection-detector.ts`
- Add: `tests/core/review-rejection-detector.test.ts`
- Modify: `src/index.ts`

**Steps:**

- [x] **Step 1: Vitest テストを先行作成** — 設計書 §9-2 の表 #1〜#10 を完全網羅。空文字列、approve 偽陽性除外、単一/複数行マッチ、excerpts 上限 3 件、各 excerpt の 200 文字切り詰め、`summary` ≤300 文字、日本語パターン (`不承認`/`要修正`/`致命的`/`ブロッカー` 等)、大文字小文字無視を検証。
- [x] **Step 2: `REVIEW_REJECTION_PATTERNS` を `Object.freeze` で実装** — 設計書 §6-1 の RegExp 配列をそのまま採用。`matchesReviewRejection(text): boolean` も export。
- [x] **Step 3: `ReviewRejectionDetector.detect(text)` を実装** — `ReviewRejectionSignal { matched, excerpts: readonly string[], summary: string }` を返す。excerpts は最大 3 件・各 ≤200 文字、summary ≤300 文字。
- [x] **Step 4: `src/index.ts` から export**
- [x] **Step 5: Devcontainer 内で全検証コマンド実行**
- [x] **Step 6: Phase Base に向けた Draft PR を作成**

---

## Phase 2: Role-based Wisdom Store

`WisdomEntry` への `persona` フィールド必須化と、`Map<AgentId, WisdomEntry[]>` 内部表現への再構成。Phase 2 内のタスクは型レベルの破壊変更を伴うため**直列依存**で進める。Phase 1 Task 3 (`PersonaClassifier`) のマージ完了が前提。

### Task 1: `WisdomEntry` 型と Draft の persona 拡張

**Branch:** `feature/jia-phase2-task1_wisdom-types-extension` ← Base 派生

**Files:**
- Modify: `src/core/types.ts`
- Modify: `tests/core/types.test.ts`
- Add: `tests/helpers/wisdom-draft-factory.ts`

**Steps:**

- [x] **Step 1: 型テスト先行作成** — `WisdomEntry.persona: AgentId` が必須であること、`WisdomEntryDraft.persona?: AgentId` がオプショナルであること、`AddOptions { scope?, persona? }` を含むこと、を `tsc --noEmit` 経由でコンパイル時検証。
- [x] **Step 2: `src/core/types.ts` を §3-1 通りに変更** — `WisdomEntry` に `readonly persona: AgentId` 追加、`WisdomEntryDraft` を `Omit<WisdomEntry, "id" | "timestamp" | "persona"> & { persona?: AgentId }` に変更、`AddOptions { scope?, persona? }` を追加。
- [x] **Step 3: `tests/helpers/wisdom-draft-factory.ts` を実装** — `makeWisdomDraft(partial?)` のデフォルト `{ taskId: "task-1", category: "success_pattern", content: "test", persona: "hephaestus" }`。既存テストの書き換え量最小化のため、新規ヘルパー経由で draft を構築する移行ガイドをコメントで明記。
- [x] **Step 4: 型変更で壊れる既存テスト箇所を一覧化** — `grep -rn "WisdomEntry" tests/` で全箇所列挙し、各テストで `makeWisdomDraft` 経由に変換するか、`persona` を明示。型エラー 0 になるまで修正。
- [x] **Step 5: Devcontainer 内で `bun run typecheck && bun run test` を実行し全 pass 確認**
- [x] **Step 6: Phase Base に向けた Draft PR を作成**

### Task 2: `WisdomStore` ペルソナ別内部表現

**Branch:** `feature/jia-phase2-task2_wisdom-store-by-persona` ← Task 1 派生 (型変更に強依存)

**Files:**
- Modify: `src/core/wisdom-store.ts`
- Modify: `tests/core/wisdom-store.test.ts`

**Steps:**

- [x] **Step 1: Vitest テストを先行作成・更新** — 設計書 §9-7 の表 #1〜#10 を網羅。`add` の persona 確定優先順位 (options > draft.persona > classifier フォールバック)、`getRelevant({ persona })` 絞り込み、`getRelevant({ persona, maxEntries })`、persona 未指定時の昇順全件返却、LRU eviction が最古エントリ保有 bucket から削る挙動、`replaceEntries([])` の全 bucket クリア、persona 欠落 entry を `replaceEntries` で受けた際の classifier 振り分けを検証。#10 の persona 欠落テストでは v1 マイグレーション時のランタイム入力を模擬するため `as unknown as WisdomEntry` キャストを使用する。
- [x] **Step 2: `WisdomStore` 内部を `Map<AgentId, WisdomEntry[]>` に再実装** — 設計書 §5-1 の構造を踏襲。`entriesByPersona` は 4 ペルソナで初期化。`add` で persona 確定後 `entriesByPersona.get(persona).push()`。
- [x] **Step 3: `evictOldestIfOverflow` を実装** — 全 bucket の合計が `maxEntries` を超える限り、最古 timestamp を保有する bucket から `shift`。
- [x] **Step 4: `getRelevant`/`getAllEntries`/`replaceEntries` を新 API シグネチャに合わせて実装**
- [x] **Step 5: 既存 `WisdomStoreInterface` 契約との互換性確認** — `getRelevant({persona?})` の `persona` は optional のため、persona 未指定の既存呼び出しは無変更で通る。
- [x] **Step 6: Devcontainer 内で全検証コマンド実行**
- [x] **Step 7: Phase Base に向けた Draft PR を作成**

### Task 3: `WisdomPersistence` v1/v2 マイグレーション

**Branch:** `feature/jia-phase2-task3_wisdom-persistence-v2` ← Task 2 派生 (内部表現に依存)

**Files:**
- Modify: `src/core/wisdom-persistence.ts`
- Add: `tests/core/wisdom-persistence-migration.test.ts`

**Steps:**

- [x] **Step 1: Vitest テストを先行作成** — 設計書 §9-4 の表 #1〜#11 を網羅。ファイル不在、空文字列、破損 JSON (`load` 空 / `loadStrict` throw)、v1 → v2 自動マイグレーション (classifier 経由で persona 付与)、v2 直読 (PascalCase ラベル → 内部小文字 AgentId 変換)、未知キー無視、`version === 2` 優先で `entries` 無視、`saveAtomic` 出力が v2 のみ、`mergeById` で新しい timestamp 側の persona 優先、認識不能形式の挙動、を全数検証。
- [x] **Step 2: v2 シリアル型を `src/core/types.ts` 隣接 or `wisdom-persistence.ts` 内部で定義** — `{ version: 2, maxEntries: number, byAgent: Record<PascalAgentLabel, WisdomEntry[]> }`。`AGENT_LABELS: Record<AgentId, string>` を定数化。
- [x] **Step 3: `loadStrict()` を §3-3 のフロー通りに実装** — 失敗時は `load()` が catch して空ストア (fail-open) 維持。
- [x] **Step 4: `saveAtomic()` は常に v2 形式で書き出し** — `mergeById` 内の persona 採用ルール (timestamp 新しい側) を実装。
- [x] **Step 5: テストフィクスチャ作成** — v1/v2/破損/未知キー混入の各 JSON サンプルを `tests/fixtures/` 配下 or テスト内インライン文字列で用意。
- [x] **Step 6: Devcontainer 内で全検証コマンド実行**
- [x] **Step 7: Phase Base に向けた Draft PR を作成**

### Task 4: `TieredWisdomStore` persona 伝播

**Branch:** `feature/jia-phase2-task4_tiered-wisdom-persona` ← Task 3 派生 (Store + Persistence の整合性に依存)

**Files:**
- Modify: `src/core/tiered-wisdom-store.ts`
- Modify: `tests/core/tiered-wisdom-store.test.ts`

**Steps:**

- [x] **Step 1: Vitest テストを更新** — 設計書 §9-8 の表 #1〜#4 を網羅。local 3 + global 2 合算、local 1 + global 部分補完、persona 該当なし時の空配列、local/global 同一 id 重複排除を検証。
- [x] **Step 2: `getRelevant({ persona? })` を §5-2 通りに実装** — `localIds` Set で重複排除、`maxEntries` から `local.length` を差し引いた `remaining` 件のみ global から補完。
- [x] **Step 3: `formatForInjection(entries)` の ペルソナ別ヘッダ追加** — エントリの persona が混在する場合のみ `**[JUSTICE AI: Past Learnings for <Persona>]**` ヘッダでグルーピング (§5-2 末尾)。混在しない場合は既存出力を維持。
- [x] **Step 4: `formatForInjection` の単体テストを追加** — 単一ペルソナ時はヘッダ無し、混在時はペルソナごとにブロック分割。
- [x] **Step 5: Devcontainer 内で全検証コマンド実行**
- [x] **Step 6: Phase Base に向けた Draft PR を作成**

### Task 5: `LearningExtractor` の persona 付与

**Branch:** `feature/jia-phase2-task5_learning-extractor-persona` ← Task 4 派生 (型/Store 整合性に依存)

**Files:**
- Modify: `src/core/learning-extractor.ts`
- Modify: `tests/core/learning-extractor.test.ts`
- Modify: `src/hooks/task-feedback.ts` (シグネチャ拡張)
- Modify: `tests/hooks/task-feedback.test.ts`

**Steps:**

- [x] **Step 1: Vitest テストを更新** — 設計書 §9-9 の表 #1〜#5 を網羅。context 未指定時の classifier フォールバック、context 明示時の上書き、systematic-debugging 経路 (`Root cause:` / `根本原因:` マーカー検出時の `design_decision` draft 生成)、既存 success_pattern 経路の後方互換を検証。
- [x] **Step 2: `LearningExtractor.extract(feedback, rawOutput?, context?: { persona?: AgentId })` シグネチャ拡張** — §5-5 通り。各 draft の persona は context > classifier の順で確定。
- [x] **Step 3: `extractFromSuccess` 内に根本原因マーカー分岐を追加** — `learning-extractor.ts` 内 private 定数として `ROOT_CAUSE_MARKERS = [/Root cause:/i, /根本原因[:：]/u]` を保持。マッチ時 `category: "design_decision"` draft を生成。
- [x] **Step 4: `TaskFeedbackHandler.setActivePlan(plan, agentId?: AgentId)` シグネチャ拡張** — `session.currentAgent` として保持、`extract` 呼び出しに伝播。
- [x] **Step 5: 既存 `task-feedback.test.ts` の呼び出し箇所互換性確認** — `agentId` はオプショナル維持のため既存呼び出しは無変更で動作することを assert。
- [x] **Step 6: Devcontainer 内で全検証コマンド実行**
- [x] **Step 7: Phase Base に向けた Draft PR を作成**

---

## Phase 3: Plan-to-Execution Bridge

`writing-plans` 完了検知と Atlas Guidance Directive 注入。Phase 2 マージ完了が前提 (Wisdom Store の persona 拡張に依存)。

### Task 1: `PlanCompletionDetector`

**Branch:** `feature/jia-phase3-task1_plan-completion-detector` ← Base 派生 (型依存: Phase 1 Task 3 の `PersonaClassifier`/`AgentId`)

**Files:**
- Add: `src/core/plan-completion-detector.ts`
- Add: `tests/core/plan-completion-detector.test.ts`

**Steps:**

- [x] **Step 1: Vitest テストを先行作成** — 設計書 §9-3 の表 #1〜#15 を完全網羅。skill_marker (PreToolUse 保留)、result_path (specs パスマッチ)、result_marker (`## Architecture` + `## Implementation` 同時出現 / `Root cause:` / `根本原因:`)、isError=true で `null`、無関係文字列で `null`、保留消去後の再評価、TTL 境界 (5min ±1ms、`Date.now` モック必須)、最大件数 LRU (51 セッション登録で最古 evict)、`lastInvokedPersona` のスキル名/agent フィールド対応表 (§4-1 表)、不正 toolInput の防御的扱いを全数検証。
- [x] **Step 2: 内部状態として `(sessionId, SkillTarget)` 複合キーの保留 Map と `(sessionId → AgentId)` の `lastInvokedPersona` Map を実装** — TTL 5 分、最大 50 セッション、`LoopDetectionHandler` と同水準の LRU。
- [x] **Step 3: `recordPreToolUseInvocation(sessionId, toolName, toolInput)` を実装** — §4-1 の保留登録ロジック + `lastInvokedPersona` 対応表 (`toolInput.agent` > `skills`/`loadSkills` > `role`/`prompt` 部分一致)。同一 task() で複数スキル指定時は独立保留。
- [x] **Step 4: `evaluateSkillCompletion(sessionId, toolName, toolResult, isError, target)` を実装** — 保留あり → `confidence: high`、保留なくとも result マーカー一致 → `confidence: medium`。検出後 `(sessionId, target)` 保留のみ消去 (他 target は影響なし)。isError=true は常に null。
- [x] **Step 5: `lastInvokedPersona(sessionId): AgentId | undefined` を実装** — §4-1 表の優先順位通り。
- [x] **Step 6: 検出マーカー定数を private に保持** — writing-plans: `docs/superpowers/specs/\d{4}-\d{2}-\d{2}-.*-design\.md` + `## Architecture` + `## Implementation`、systematic-debugging: `Root cause:` / `根本原因:`。
- [x] **Step 7: `src/index.ts` から export**
- [x] **Step 8: Devcontainer 内で全検証コマンド実行**
- [x] **Step 9: Phase Base に向けた Draft PR を作成**

### Task 2: `mergePostToolUseResponses`

**Branch:** `feature/jia-phase3-task2_merge-posttooluse` ← Base 派生 (HookResponse 既存型のみ)

**Files:**
- Add: `src/core/plan-bridge-utils.ts`
- Add: `tests/core/plan-bridge-utils.test.ts`

**Steps:**

- [x] **Step 1: Vitest テストを先行作成** — 4 ケース網羅: (1) 両方 `proceed` → `proceed`、(2) 片方 `inject` + 片方 `proceed` → `inject`、(3) 両方 `inject` → 連結 (`${a}\n\n---\n\n${b}`)、(4) 片方 `skip` を含む → `skip` (最優先)。境界として `a.injectedContext === ""` の場合も連結フォーマットに従うことを確認。
- [x] **Step 2: `mergePostToolUseResponses(a, b): HookResponse` を §4-4 通りに純粋関数として実装** — 入力不変、戻り値毎回新規生成。
- [x] **Step 3: `justice-plugin.ts` 内の `PostToolUse` 経路で `PlanBridge.handlePostToolUse` と `TaskFeedbackHandler.handlePostToolUse` を直列実行し `mergePostToolUseResponses` で合成する経路を準備** — ただし `PlanBridge.handlePostToolUse` 本体は Task 3 で実装するため、ここでは「未実装時に proceed を返すスタブ」を一時的に挟むか、`handlePostToolUse?.()` の optional chain で吸収。
- [x] **Step 4: Devcontainer 内で全検証コマンド実行**
- [x] **Step 5: Phase Base に向けた Draft PR を作成**

### Task 3: `PlanBridge.handlePostToolUse` (Atlas Guidance)

**Branch:** `feature/jia-phase3-task3_plan-bridge-handle-post` ← Task 2 派生

**Files:**
- Modify: `src/hooks/plan-bridge.ts`
- Modify: `tests/hooks/plan-bridge.test.ts`

**Steps:**

- [x] **Step 1: Vitest テストを先行作成・更新** — 設計書 §9-10 の表 #1, #4 (writing-plans 完了検知時のみ、Prometheus 経路と Sisyphus 経路は Phase 4 で網羅) を網羅。`action: "inject"`、`injectedContext` 先頭が 🎯 バナー (notifier.formatBanner 経由)、本文に「自ら実装に着手せず」を含むことを assert。`PreToolUse` 保留登録パスもテスト。
- [x] **Step 2: `JusticePlugin` コンストラクタで `notifier?: JusticeNotifier` を受け取り、デフォルト `NoOpNotifier` を設定** — `PlanBridge` コンストラクタにも propagate。
- [x] **Step 3: `PlanBridge.handlePreToolUse` を拡張** — `PlanCompletionDetector.recordPreToolUseInvocation(sessionId, toolName, toolInput)` を呼び出し。既存ロジックは保持。
- [x] **Step 4: `PlanBridge.handlePostToolUse` を §4-2 通りに実装** — 早期リターンせず、writing-plans と systematic-debugging の両スキルを独立評価し、各結果を `mergePostToolUseResponses` で合成する。writing-plans 検知 → `buildAtlasGuidanceResponse` で Atlas Guidance Directive (§4-3) を生成。`notifier.formatBanner({ variant: "atlas_orchestration", title: "Atlas Orchestration", message: ... })` を `injectedContext` 先頭に挿入、続けて Directive 本文。`notifier.notify(...)` も呼び出し。Prometheus pivot 経路も合成結果に対して `mergePostToolUseResponses` で統合する。
- [x] **Step 5: `AgentRouter.route()` で推奨エージェントを決定** — `CategoryClassifier` 推定 + 関連スキルで呼び出し。`confidence: medium` 時のみ末尾に「自動検知。意図と異なる場合は無視可」注記を追加。
- [x] **Step 6: Phase 3 完了時点では Prometheus pivot 経路と Sisyphus Wisdom 保存経路は `PROCEED` を返すスタブとし `// TODO: Phase 4` コメントを付与** — Task 3 では writing-plans 経路のみ完成させる。合成ロジックの骨格（両スキル評価 + merge）は Task 3 時点で組み込む。
- [x] **Step 7: Devcontainer 内で全検証コマンド実行**
- [x] **Step 8: Phase Base に向けた Draft PR を作成**

---

## Phase 4: SDD Native Error Handling

Prometheus 連続却下検知 → Hephaestus pivot 注入、および Sisyphus systematic-debugging 完了 → Wisdom 保存経路。Phase 3 マージ完了が前提。

### Task 1: `LoopDetectionHandler.recordReviewOutput` + Pivot 判定

**Branch:** `feature/jia-phase4-task1_loop-handler-pivot` ← Base 派生 (Phase 1 Task 4 + Phase 2 マージ後)

**Files:**
- Modify: `src/hooks/loop-handler.ts` (`LoopDetectionHandler`)
- Modify: `tests/hooks/loop-handler.test.ts`

**Steps:**

- [x] **Step 1: Vitest テストを先行作成・更新** — 設計書 §9-11 の表 #1〜#9 を完全網羅。NG 1 回 (pivoted: false)、3 回 (pivoted: true, reason: "review_rejection_threshold", targetAgent: "hephaestus")、2 回 (直前で pivoted: false)、マッチなし (rejections 据え置き)、環境変数 `MAX_REVIEW_REJECTIONS_BEFORE_PIVOT=5` で 5 回目発火、環境変数 `"abc"`/`"0"`/`"-1"` のデフォルトフォールバック、`recordTrial` への連動記録 (`agent: "prometheus", result: "failure", wisdom: "review_rejected: ..."`)、`removeSession` 時の rejections Map クリーンアップを検証。
- [~] **Step 2: `recordReviewOutput(sessionId, taskId, reviewerOutput): PivotDecision` を §6-3 通りに実装** — 内部で `ReviewRejectionDetector.detect()` 呼び出し → 一致時のみ rejections Map に excerpt 追記 + `recordTrial` 連動記録。`PivotDecision { pivoted, targetAgent, rejections, maxRejections, reason?, recentExcerpts }` を毎回新規生成。**※ 現在の実装では excerpts 追記と recordTrial 連動が未実装。**
- [x] **Step 3: 環境変数読み込みヘルパー** — `MAX_REVIEW_REJECTIONS_BEFORE_PIVOT` を `parseInt` し、`NaN` / `<= 0` ならデフォルト 3。
- [x] **Step 4: `removeSession` で `rejections` Map のセッションエントリも削除**
- [x] **Step 5: `PivotReason` 型と `PivotDecision` 型を export**
- [x] **Step 6: Devcontainer 内で全検証コマンド実行**
- [x] **Step 7: Phase Base に向けた Draft PR を作成**

- [x] **Step 1: Vitest テストを更新** — 設計書 §9-10 の表 #3 (3 回目 NG で pivot バナー🚧 + Hephaestus 文言注入) を網羅。`lastInvokedPersona === "prometheus"` の場合のみ `recordReviewOutput` を呼ぶこと、それ以外の persona では呼ばないことを assert。
- [x] **Step 2: `PlanBridge.handlePostToolUse` 内の Phase 3 スタブを §4-2 ステップ 3 通りに実装** — `toolName === "task"` かつ `lastInvokedPersona === "prometheus"` の場合、`getActiveTaskIdForSession(sessionId)` で taskId 取得 → `loopHandler.recordReviewOutput()` 呼び出し → `decision.pivoted` なら `buildPivotInjectionResponse` で §6-4 の pivot プロンプトを生成。
- [x] **Step 3: `buildPivotInjectionResponse` を実装** — `notifier.formatBanner({ variant: "architecture_pivot", title: "Architecture Pivot", message: ... })` を先頭、続けて §6-4 のプロンプト本文 (excerpts は `decision.recentExcerpts` から最大 3 件表示)。`notifier.notify(...)` も呼び出し。
- [x] **Step 4: `PlanBridge` コンストラクタで `loopHandler` を optional 注入** — `loopHandler` 未注入時は Prometheus 経路をスキップして `proceed`。
- [x] **Step 5: `justice-plugin.ts` で `PlanBridge` 構築時に `loopHandler` を渡す**
- [x] **Step 6: Devcontainer 内で全検証コマンド実行**
- [x] **Step 7: Phase Base に向けた Draft PR を作成**

### Task 3: Sisyphus Wisdom 保存経路

**Branch:** `feature/jia-phase4-task3_sisyphus-wisdom-route` ← Task 2 派生

**Files:**
- Modify: `src/hooks/plan-bridge.ts`
- Modify: `tests/hooks/plan-bridge.test.ts`

**Steps:**

- [x] **Step 1: Vitest テストを更新** — 設計書 §9-10 の表 #2, #5 を網羅。systematic-debugging 完了検知時に `wisdomStore.add` が `persona: "sisyphus"` で呼ばれること、wisdomStore が null の場合は保存をスキップして `proceed` を返すこと (エラーにしない) を assert。
- [x] **Step 2: `PlanBridge.handlePostToolUse` 内の Sisyphus 経路を §6-5 通りに実装** — `evaluateSkillCompletion(..., "systematic-debugging")` 検知時、`learningExtractor.extract(feedback, rawOutput, { persona: "sisyphus" })` で draft 抽出 → `wisdomStore.add(draft, { persona: "sisyphus" })` で全件保存。
- [x] **Step 3: `injectedContext` に Sisyphus Insight バナー (🔬 `variant: "sisyphus_insight"`) を挿入** — `notifier.formatBanner` + `notifier.notify` 経由。本文は「systematic-debugging 完了。N 件の Wisdom を Sisyphus 名前空間に保存しました」相当のサマリ。
- [x] **Step 4: fail-open 確認** — `wisdomStore.add` 内で例外発生時も hook は `proceed` で returnableを保証 (try/catch で吸収)。
- [x] **Step 5: Devcontainer 内で全検証コマンド実行**
- [x] **Step 6: Phase Base に向けた Draft PR を作成**

---

## Phase 5: Integration & Wrap-up

Adapter 配線、統合テスト、最終検証。Phase 1〜4 の全 Task がマージ済みであることが前提。

### Task 1: `OpenCodeAdapter` への `OpenCodeNotifier` 注入 + ペルソナ別注入経路統合

**Branch:** `feature/jia-phase5-task1_adapter-wiring` ← Base 派生 (Phase 1-4 マージ後)

**Files:**
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `tests/runtime/opencode-adapter.test.ts` (存在すれば)
- Modify: `src/index.ts` (最終エクスポート確認)
- Modify: `src/hooks/plan-bridge.ts` (handleMessage / handlePreToolUse でのペルソナ別 wisdom 注入)

**Steps:**

- [x] **Step 1: テストを先行作成・更新** — `OpenCodeAdapter.ensureInitialized()` 内で `OpenCodeNotifier` が `client.app.log` を bind して構築され、`JusticePlugin` の `notifier` オプションに渡されることを assert。モック client で `log` 呼び出しが発生することを確認。
- [x] **Step 2: `runtime/opencode-adapter.ts` を §7-6 通りに更新** — `const notifier = new OpenCodeNotifier(this.#init.client.app.log)` → `new JusticePlugin(localFs, localFs, { logger, onError, globalFileSystem, notifier })`。
- [ ] **Step 3: `PlanBridge.handleMessage` で persona 別 wisdom 注入を有効化** — §5-4 通り、`delegation.context.agentId ?? "hephaestus"` を `tieredWisdomStore.getRelevant({ persona })` に渡す。
- [ ] **Step 4: `PlanBridge.handlePreToolUse` の task() 経路でも同様の persona 別注入を適用** — `toolInput` から推定したペルソナ (`PlanCompletionDetector.lastInvokedPersona` と同等ロジック or 直接) で wisdom を絞り込み。
- [ ] **Step 5: `LoopDetectionHandler.setActivePlan` で `currentAgent` 変更検知** — §5-4 通り、必要なら wisdom 再注入トリガに繋ぐ。
- [ ] **Step 6: `src/index.ts` から Phase 1-4 で追加した全 export が含まれていることを最終確認**
- [ ] **Step 7: Devcontainer 内で全検証コマンド実行**
- [ ] **Step 8: Phase Base に向けた Draft PR を作成**

### Task 2: 統合テスト

**Branch:** `feature/jia-phase5-task2_integration-tests` ← Task 1 派生

**Files:**
- Add: `tests/integration/atlas-orchestration-flow.test.ts`
- Add: `tests/integration/role-based-wisdom-flow.test.ts`
- Add: `tests/integration/review-rejection-pivot-flow.test.ts`
- Add: `tests/integration/sisyphus-debugging-flow.test.ts`

**Steps:**

- [ ] **Step 1: `atlas-orchestration-flow.test.ts` を実装** — 設計書 §9-12 シナリオ通り。PreToolUse (skills: writing-plans) → PostToolUse (toolResult に planPath + Architecture/Implementation マーカー) → `inject` レスポンスに 🎯 バナー + 推奨エージェント "hephaestus" を含むこと、次の task() で `previousLearnings` が atlas wisdom 由来であることを検証。**加えて `mockNotifier.calls` に `variant: "atlas_orchestration"` の `notify` 呼び出しが 1 件記録され、`mockNotifier.banners` の最後の要素が `injectedContext` 先頭バナーと一致することを assert**。
- [ ] **Step 2: `role-based-wisdom-flow.test.ts` を実装** — §9-12 シナリオ通り。hephaestus 3 件 + atlas 2 件追加 → `getRelevant({ persona: "atlas" })` で 2 件のみ取得、injectedContext に hephaestus wisdom が含まれないことを assert。
- [ ] **Step 3: `review-rejection-pivot-flow.test.ts` を実装** — §9-12 シナリオ通り。PreToolUse (skills: code-quality-reviewer) × 3 連発 + PostToolUse "REJECTED: ..." × 3 → 3 回目で `inject` + 🚧 バナー + Hephaestus 文言、`getTrialHistory` に prometheus failure × 3 が記録されていることを assert。**加えて 3 回目で `mockNotifier.calls` に `variant: "architecture_pivot"` の呼び出しが追加されること、1〜2 回目では追加されないことを assert**。
- [ ] **Step 4: `sisyphus-debugging-flow.test.ts` を実装 (新規)** — シナリオ: (1) PreToolUse: `task`, `toolInput: { skills: ["systematic-debugging"], prompt: "..." }` 発火 → 保留登録。(2) PostToolUse: `toolResult` に `"Root cause: race condition in queue handler"` を含む文字列を渡す。期待:
  - `inject` レスポンスの先頭に 🔬 バナー (`variant: "sisyphus_insight"`) が挿入される
  - `wisdomStore.add` が `persona: "sisyphus"` 指定で 1 件以上呼び出され、保存後 `wisdomStore.getRelevant({ persona: "sisyphus" })` で当該 entry が取得できる
  - 抽出された draft の少なくとも 1 件は `category: "design_decision"` を持つ (根本原因マーカー検出経路)
  - `mockNotifier.calls` に `variant: "sisyphus_insight"` の `notify` が 1 件記録される
  - 日本語マーカー `"根本原因: ..."` でも同じ経路が動作することを別ケースで確認
- [ ] **Step 5: `tests/helpers/mock-notifier.ts` + `tests/helpers/wisdom-draft-factory.ts` + 既存 `mock-file-system.ts` を活用して I/O はすべてモック経由に統一** — 全統合テストで `createMockNotifier()` を `JusticePluginOptions.notifier` 経由で注入し、`calls`/`banners` を経路ごとに検証可能にする。
- [ ] **Step 6: Devcontainer 内で `bun run test tests/integration` を含む全検証コマンド実行**
- [ ] **Step 7: Phase Base に向けた Draft PR を作成**

### Task 3: 最終検証 + Phase Base マージ準備

**Branch:** `feature/jia-phase5-task3_final-verification` ← Task 2 派生

**Files:**
- Modify: `CHANGELOG.md` (リリースノート追記)
- Modify: `README.md` (新機能セクション、必要に応じ)

**Steps:**

- [ ] **Step 1: Devcontainer 内で全コマンドを最終実行** — `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run test && bun run build`。検収基準すべて満たすこと。
- [ ] **Step 2: `dist/opencode-plugin.js` の生成と最低限の smoke import** — `node -e "require('./dist/opencode-plugin.js')"` 相当が成功すること。
- [ ] **Step 3: 全テスト pass を確認** — `bun run test` がエラー 0 で完了し、出力サマリの `failures: 0` および skip された不正な suite が無いことを確認。件数は Phase 1〜4 で累積追加されるため固定値で照合せず、定性的に「すべて pass」をもって合格とする。
- [ ] **Step 4: `CHANGELOG.md` に 4 機能の追加を Conventional Commits 準拠で追記** — `feat(core): role-based wisdom store with v1→v2 migration`、`feat(hooks): plan-to-execution bridge with Atlas guidance`、`feat(hooks): SDD review-rejection pivot to Hephaestus`、`feat(runtime): toast-equivalent notifier (log + banner)`。
- [ ] **Step 5: 設計書 §14 受け入れ条件 1〜6 をチェックリスト化し、各項目の検証手順を実行**:
  - [ ] (1) writing-plans 完了直後 → Atlas Guidance Directive 注入
  - [ ] (2) wisdom.json v2 形式で永続化、Atlas 起動時に atlas 名前空間のみ注入
  - [ ] (3) Prometheus 連続 3 回 NG → Hephaestus pivot 注入
  - [ ] (4) systematic-debugging 完了 → Sisyphus 名前空間に保存
  - [ ] (5) 全 hook 発火時、`injectedContext` 先頭にバナー + `client.app.log` 通知
  - [ ] (6) 既存テスト破壊なし、新規含め全 pass
- [ ] **Step 6: Phase Base ブランチ (`feature/justice-invisible-advisor__base`) を `master` にマージするための最終 PR を Draft で作成** — Phase 5 Task 3 自体は Phase Base への Draft PR、最終マージは別途レビュー後。

---

## 完了の定義 (Definition of Done)

- [ ] 全 Phase の全 Task が Devcontainer 内で `bun run typecheck && bun run lint && bun run test && bun run build` を pass している
- [ ] 各 Task に対応する Draft PR が `feature/justice-invisible-advisor__base` をターゲットに作成されている
- [ ] 設計書 §14 受け入れ条件 1〜6 すべてが Phase 5 Task 3 で検証済み
- [ ] `wisdom.json` v1 → v2 マイグレーションが既存ユーザーのデータを破壊しない (`load()` fail-open + classifier フォールバック)
- [ ] 新規 npm 依存ゼロ
- [ ] `dist/opencode-plugin.js` が正常ビルドされる
