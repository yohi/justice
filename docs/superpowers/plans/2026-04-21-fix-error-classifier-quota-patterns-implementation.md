# Fix Error Classifier Provider Quota Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/core/provider-error-patterns.ts` におけるクォータ関連の3つの正規表現（`/payment.?required/i`, `/usage\s+limit/i`, `/out\s+of\s+credits?/i`）を `PROVIDER_CONFIG_PATTERNS` から `PROVIDER_TRANSIENT_PATTERNS` に移動させ、関連するテストを修正する。

**Architecture:** 対象のファイルとテストファイルを直接編集するだけの単純な定数配列の移動および文字列アサーションの移管。

**Tech Stack:** TypeScript, Vitest, Bun

---

### Task 1: パターンの移動と provider-error-patterns.test.ts の修正

**Files:**
- Modify: `src/core/provider-error-patterns.ts`
- Modify: `tests/core/provider-error-patterns.test.ts`

- [ ] **Step 1: src/core/provider-error-patterns.ts を編集する**

`src/core/provider-error-patterns.ts` を開き、以下の3つの正規表現を `PROVIDER_CONFIG_PATTERNS` から削除し、`PROVIDER_TRANSIENT_PATTERNS` の末尾に追加する。
- `/payment.?required/i`
- `/usage\s+limit/i`
- `/out\s+of\s+credits?/i`

- [ ] **Step 2: tests/core/provider-error-patterns.test.ts を編集する**

`tests/core/provider-error-patterns.test.ts` を開き、`describe("PROVIDER_CONFIG_PATTERNS")` 内の `positiveExamples` から以下を削除し、`describe("PROVIDER_TRANSIENT_PATTERNS")` 内の `positiveExamples` に追加する。
- `"Out of credits"`
- `"Payment Required"`

- [ ] **Step 3: テストを実行して PASS することを確認する**

Run: `bun run test tests/core/provider-error-patterns.test.ts`
Expected: PASS

- [ ] **Step 4: コミットする**

```bash
git add src/core/provider-error-patterns.ts tests/core/provider-error-patterns.test.ts
git commit -m "fix(core): move quota error patterns to transient classification"
```

---

### Task 2: error-classifier.test.ts の修正

**Files:**
- Modify: `tests/core/error-classifier.test.ts`

- [ ] **Step 1: tests/core/error-classifier.test.ts を編集する**

`tests/core/error-classifier.test.ts` を開き、`describe("per-pattern coverage — provider_config")` 内の `configSamples` 配列から以下の3要素を削除し、`describe("per-pattern coverage — provider_transient")` 内の `transientSamples` 配列に移動する。
- `[/payment.?required/i, "payment required"]`
- `[/usage\s+limit/i, "usage limit reached"]`
- `[/out\s+of\s+credits?/i, "out of credits"]`

- [ ] **Step 2: テストを実行して PASS することを確認する**

Run: `bun run test tests/core/error-classifier.test.ts`
Expected: PASS

- [ ] **Step 3: 全てのテストを実行して PASS することを確認する**

Run: `bun run test`
Expected: PASS

- [ ] **Step 4: コミットする**

```bash
git add tests/core/error-classifier.test.ts
git commit -m "test(core): fix error classifier pattern coverage tests for quota errors"
```
