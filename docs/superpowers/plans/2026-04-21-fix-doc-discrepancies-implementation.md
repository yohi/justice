# Fix Documentation Discrepancies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tiered Wisdom Store の秘密検知ロジックおよび Error Classifier のエスカレーションメッセージをドキュメントの設計通りに修正する。

**Architecture:** 
1. `ErrorClassifier`: `provider_transient` のメッセージを詳細化。
2. `TieredWisdomStore`: 秘密検知時のグローバル保存ブロックを解除し、警告ログのバグ（`undefined` 表示）を修正。

**Tech Stack:** TypeScript, Vitest, Bun

---

## Task 1: Error Classifier Escalation Message Fix

**Files:**
- Modify: `src/core/error-classifier.ts`
- Modify: `tests/core/error-classifier.test.ts`

- [ ] **Step 1: Update Escalation Message**
`src/core/error-classifier.ts` を編集し、`provider_transient` のメッセージを設計書通りに修正する。

- [ ] **Step 2: Update Tests**
`tests/core/error-classifier.test.ts` を編集し、`getEscalationMessage` のテストアサーションを更新する。

- [ ] **Step 3: Run Tests**
`bun run test tests/core/error-classifier.test.ts` を実行し、PASSすることを確認する。

---

## Task 2: Tiered Wisdom Store Secret Detection Fix

**Files:**
- Modify: `src/core/tiered-wisdom-store.ts`
- Modify: `tests/core/tiered-wisdom-store.test.ts`

- [ ] **Step 1: Fix Secret Detection Logic & Logging**
`src/core/tiered-wisdom-store.ts` を編集。
  - `add` メソッドで秘密検知時に `this.localStore.add` へフォールバックしている箇所を削除し、常に `this.globalStore.add`（または指定スコープ）が実行されるようにする。
  - 警告ログ内の `detected.map((m) => m.name)` を `detected` に修正。

- [ ] **Step 2: Update Tests**
`tests/core/tiered-wisdom-store.test.ts` を編集。
  - `should log warn and cancel promotion when an entry with secrets is targeted for global` テストケースを、書き込みがキャンセルされない（`globalStore.add` が呼ばれる）ことを期待するように修正。

- [ ] **Step 3: Run Tests**
`bun run test tests/core/tiered-wisdom-store.test.ts` を実行し、PASSすることを確認する。

---

## Task 4: Final Verification

- [ ] **Step 1: Run All Checks**
`bun run test && bun run typecheck && bun run lint` を実行し、全件PASSすることを確認する。

- [ ] **Step 2: Commit**
```bash
git add .
git commit -m "fix: resolve documentation discrepancies in TieredWisdomStore and ErrorClassifier"
```
